const express = require("express");
const http = require("http");
const https = require("https");
const handlebars = require("express-handlebars");
const bodyParser = require("body-parser");
const got = require("got");
const fs = require("fs");
const { promisify } = require("util");

const { build_resort_list_str, prompt_user_and_wait } = require("./cli");
const { load_token_and_cookies, test_ikon_token_and_cookies, get_ikon_reservation_dates, get_ikon_resorts } = require("./ikon_proxy");
const { send_confirmation_email } = require("./sendgrid_proxy.js");

if (!process.env.DEPLOY_STAGE || process.env.DEPLOY_STAGE === '') {
    console.log("Need to source setup_env.sh to set env variables. Make sure server is started with start script not manually");
    process.exit(1);
}

// Bind async write to fs.write
const appendFile = promisify(fs.appendFile);
const data_filename = "./reservation_polling_data.txt";

// Globals (for now at least)
let resorts = [];

const app = express();
app.engine("handlebars", handlebars());
app.set("view engine", "handlebars");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get("/health", (req, res) => res.send("Surviving not thriving"));

app.get("/", (req, res) => {
    res.render("home");
});

app.get("/resorts", (req, res) => {
    // Split the resorts up by ikon reservations, resort-specific site reservations, and no reservations required
    let available_resorts = [];
    let non_available_resorts = [];
    let non_reservation_resorts = [];
    for (const resort of resorts) {
        if (resort.reservations_enabled) {
            available_resorts.push(resort);
        } else if (resort.reservation_system_url != ""){
            non_available_resorts.push(resort);
        } else {
            non_reservation_resorts.push(resort);
        }
    }
    res.render("resorts", { available_resorts, non_available_resorts, non_reservation_resorts });
});

app.get("/reservation-dates", (req, res) => {
    const resort_id_str = req.query.resort;
    if (!resort_id_str) {
        return res.status(400).send("You need to choose a resort first.");
    }

    const resort_id = parseInt(resort_id_str);

    const resort = resorts.filter(x => x.id == resort_id)[0];
    res.render("reservation-dates", { resort });
});

app.post("/save-notification", async (req, res) => {
    if (!req.body) {
        return res.status(400).send("Incorrect parameters received.");
    }

    const resort_id_str = req.body["resort-id"];
    const reservation_date_str = req.body["reservation-date"];
    const email = req.body["email"];
    if (!resort_id_str || !reservation_date_str || !email) {
        res.status(400).send("Incorrect parameters received.");
    }

    const resort_id = parseInt(resort_id_str);

    // todo :: validate this better
    const simple_date_regex = /^[0-9]{4}[\/,-][0-9]{2}[\/,-][0-9]{2}$/;
    if (!simple_date_regex.test(reservation_date_str)) {
        res.status(400).send("Invalid date format, please go back and try again. If entering a date manually instead of using a browser-specific datepicker, please format as YYYY-MM-dd.");
        return;
    }

    // Get ikon reservation data for this specific resort
    let reservation_info = await get_ikon_reservation_dates(resort_id);
    if (reservation_info.error) {
        console.error(reservation_info.error_message);
        return res.status(500);
    }

    // Dates need to be zeroed out otherwise comparison fails
    const closed_dates = reservation_info.data[0].closed_dates.map(x => {
        const d = new Date(x + "Z");
        d.setUTCHours(0, 0, 0, 0);
        return d;
    });
    const unavailable_dates = reservation_info.data[0].unavailable_dates.map(x => {
        const d = new Date(x + "Z");
        d.setUTCHours(0, 0, 0, 0);
        return d;
    });

    // It should parse it as UTC but tack onthe Z to force it for all cases
    let chosen_date = new Date(reservation_date_str + "Z");
    chosen_date.setUTCHours(0, 0, 0, 0);

    let response_str;
    if (closed_dates.find(x => x.getTime() == chosen_date.getTime())) {
        response_str = "Resort is closed on that date, reservations will never be available. Notification not saved.";
    } else if (unavailable_dates.find(x => x.getTime() == chosen_date.getTime())) {
        try {
            // email, resort id, reservation date, current date
            const now = Date.now();
            const polling_data = `\n${email},${resort_id},${chosen_date.getTime()},${now}`;
            await appendFile(data_filename, polling_data);
            response_str = "Reservations are full for your selected date, notification has been saved and you will be notified if a slot opens up. Check email for confirmation.";
            console.log(`Saved notification for ${email}`);
            await send_confirmation_email(email, resort_id, chosen_date, now);
        } catch (err) {
            response_str = "Reservations are full for your selected date, but there was an internal issue saving your notification preferences. Please try again, or if the problem persists contact me."
            console.error("Error saving to reservation file: ");
            console.error(err);
        }
    } else {
        response_str = "Reservations available for that date, go to ikonpass.com to reserve. Notification not saved.";
    }

    res.render("notification-status", { status_message: response_str });
});

app.post("/refresh-ikon-auth", async (req, res) => {
    // Get call reservation data function with resort id to force auth refresh
    let reservation_info = await get_ikon_reservation_dates(1);
    if (reservation_info.error) {
        console.error(reservation_info.error_message);
        return res.status(500);
    }

    return res.status(204);
});

async function main() {
    let { error, error_message, data } = await load_token_and_cookies();
    if (error) {
        console.error(error_message);
        return;
    }

    // Test our logged-in cookies to make sure we have acces to the api now
    const success = await test_ikon_token_and_cookies();
    if (!success)
    {
        console.error("Failed validating received cookies and token on /me endpoint");
        return;
    }

    console.log("Initial Ikon API established");
    ({ error, error_message, data } = await get_ikon_resorts());
    if (error) {
        console.error("GET ikon resorts failed.");
        console.error(error_message);
        return;
    }

    resorts = data;
    console.log("Successfully retrieved and parsed Ikon resorts");

    let port;
    if (process.env.DEPLOY_STAGE == "DEV") {
        console.log("Setting up https with self-signed local certs for dev env");
        port = 443;
        var key = fs.readFileSync(__dirname + '/self-signed-ikon-reservations-key.pem');
        var cert = fs.readFileSync(__dirname + '/self-signed-ikon-reservations-cert.pem');
        var creds = {
            key: key,
            cert: cert
        };
    } else {
        if (!process.env.PROD_SSL_KEY_PATH || !process.env.PROD_SSL_CERT_PATH || !process.env.PROD_SSL_CA_CERT_PATH) {
            console.log("SSL cert env variables not set. Source the setup_env.sh script");
            process.exit(1);
        }

        console.log("Setting up https with letsencrypt certs for prod env");
        port = 6443;

        const key = fs.readFileSync(process.env.PROD_SSL_KEY_PATH);
        const cert = fs.readFileSync(process.env.PROD_SSL_CERT_PATH);
        const ca = fs.readFileSync(process.env.PROD_SSL_CA_CERT_PATH);
        creds = {
            key,
            cert,
            ca
        };
    }

    const httpsServer = https.createServer(creds, app);
    httpsServer.listen(port);
    console.log();
    console.log(`Started HTTPS server listening at ${port}`);
}

main()
	.catch(e => {
		console.error("Uncaught exception when running main()");
		console.error(e);
		process.exit(1);
	});


// todo :: get user id from /me call and use that to only show rezzy info from data array returned from resort-specific rezzy request
// todo :: double check closed and unavail lists - it looks like post-season closed dates are still in unavail list
