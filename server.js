/*
	Imports
*/

var express 		= require("express");
var app 			= express();
var port 			= 3000;
var dotenv 			= require("dotenv").config();
var passport 		= require("passport");
var Strategy 		= require("passport-facebook");
var mongojs 		= require("mongojs");
var zomato 			= require("zomato").createClient({
	userKey: process.env.APIKEY
});
var session 		= require("express-session");
var cookieParser 	= require("cookie-parser");
var bodyParser 		= require("body-parser");
var db 				= mongojs(process.env.DBURI);
var $hotel 			= db.collection("hotel");
var $users 			= db.collection("users");
var morgan 			= require("morgan");
var axios 			= require("axios");

/* 
	DB Events
*/

db.on('connect', () => {
	console.log(`[MONGO] Connected to MongoDB`);
});

db.on('error', (err) => {
	console.log(`[MONGO] Couldn't connect to MongoDB`);
});

/* 
	Passport
*/

passport.use(new Strategy({
	clientID: process.env.FBID,
	clientSecret: process.env.FBSECRET,
	callbackURL: "http://localhost:3000/auth/facebook/callback",
	profileFields: ['email', 'first_name', 'last_name']
}, (accesstoken, refreshtoken, profile, cb) => {
	$users.findOne({
		id: profile.id
	}, (err, docs) => {
		if (err) throw err;
		if(!docs) {
			$users.insert({
				id: profile.id,
				firstname: profile._json.first_name,
				lastname: profile._json.last_name,
				email: profile._json.email
			}, (err, docs) => {
				if (err) throw err;
			});
		}
	});
	return cb(null, profile)
}));

passport.serializeUser(function(user, cb) {
  cb(null, user);
});

passport.deserializeUser(function(obj, cb) {
  cb(null, obj);
});

/* 
	View Engine
*/

app.set('views', __dirname+"/views/pages");
app.set('view engine', 'ejs');


/* 
	Middlewares
*/

//app.use(morgan('dev'));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
	secret: "iamacat",
	resave: true,
	saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());


/*
	Routes
*/

app.get("/", (req, res) => {
	if(req.isAuthenticated()) {
		res.render('index', {
			firstname: req.user._json.first_name,
			lastname: req.user._json.last_name
		});
	} else {
		res.render('index', {
			firstname: false,
			lastname: false
		});
	}
});

app.get("/auth/facebook", passport.authenticate('facebook', {scope: ['email']}));

app.get('/auth/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/');
});

app.get("/logout", (req, res) => {
	if(req.isAuthenticated()) {
		req.logout();
		res.redirect("/");
	} else {
		res.redirect("/");
	}
});




app.get("/places*", (req, res) => {
	var citycode;
	if(req.isAuthenticated()) {
		zomato.getCities({
			q: req.query.city
		}, (err, result) => {
			if(err) {
				throw err;
			} else if (JSON.parse(result).location_suggestions.length>0) {
				result = JSON.parse(result);
				citycode = result.location_suggestions[0].id;
				axios.get("https://developers.zomato.com/api/v2.1/search?entity_id="+citycode+"&entity_type=city&collection_id=1", { headers: { "user-key": "845662660b17247a074784d1dd6f5694" }}).then(({data}) => {
					var final = {
						login: true,
						city: req.query.city,
						hotel: [],
						usergoing: [],
						hotelgoing: []
					};			

					// adding new hotels to database
					$hotel.find({}, (err, docs) => {
						var bulk = $hotel.initializeOrderedBulkOp();

						for(var i=0; i<data.restaurants.length; i++) {
							var findcond = false;
							for(var j=0; j<docs.length; j++) {
								if(data.restaurants[i].restaurant.id==docs[j].hid) {
									findcond = true;							
								}
							}
							if(!findcond) {
								findcond = false;
								bulk.insert({
									hid: data.restaurants[i].restaurant.id,
									going: 0
								});
							}
						}
						bulk.execute((err, response) => {
							if (err) throw err;
							console.log("[MONGO] Hotels Updated");
							$hotel.find({}, (err, hots) => {
								for (var i = 0; i<hots.length; i++) {
									for(var j = 0; j<data.restaurants.length; j++) {
										if(hots[i].hid==data.restaurants[j].restaurant.id) {
											final.hotelgoing.push(hots[i].going);
										}
									}
								}
								// find user going
								$users.findOne({
									id: req.user.id
								}, (err, documents) => {
									final.usergoing = documents.going;
									final.hotel = data.restaurants;
									res.json(final);
								});
							})
						});
					})

				});		
			} else {
				res.json("Please enter a valid city name");
			}
		});
	} else {
		zomato.getCities({
			q: req.query.city
		}, (err, result) => {
			if(err) {
				throw err;
			} else if (JSON.parse(result).location_suggestions.length>0) {
				result = JSON.parse(result);
				citycode = result.location_suggestions[0].id;
				axios.get("https://developers.zomato.com/api/v2.1/search?entity_id="+citycode+"&entity_type=city&collection_id=1", { headers: { "user-key": "845662660b17247a074784d1dd6f5694" }}).then(({data}) => {
					data.login = false;		
					
				});		
			} else {
				res.json("Please enter a valid city name");
			}
		});
	}
});

app.get("/going/:id", (req, res) => {
	if(req.isAuthenticated()) {
		$hotel.update({ 
			hid: req.params.id
		}, { $inc: {
				going: 1
			}
		}, (err, docs) => {
			if (err) throw err;
			console.log(docs);
			res.redirect("/");
		});
	} else {
		res.sendStatus(401);
	}
});

app.get("/notgoing/:id", (req, res) => {
	if(req.isAuthenticated()) {
		$hotel.update({
			hid: req.params.id
		}, { $inc: {
				going: -1
			}
		}, (err, docs) => {
			if (err) throw err;
			res.redirect("/");
		});
	} else {
		res.sendStatus(401);
	}
});

/* 
	Server
*/

app.listen(port, () => {
	console.log(`[SERVER] Server running at port ${port}`);
});