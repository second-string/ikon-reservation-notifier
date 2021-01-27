const express = require("express");
const https = require("https");
const handlebars = require("express-handlebars");
const bodyParser = require("body-parser");
const fs = require("fs");

const { store_resorts, set_routes } = require("./routes.js");
const { refresh_and_test_auth, get_ikon_resorts } = require("./ikon_proxy");

if (!process.env.DEPLOY_STAGE || process.env.DEPLOY_STAGE === '') {
    console.log("Need to source setup_env.sh to set env variables. Make sure server is started with start script not manually");
    process.exit(1);
}

const app = express();
app.engine("handlebars", handlebars());
app.set("view engine", "handlebars");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(set_routes());

async function main() {
    let { error, error_message, data } = await refresh_and_test_auth();
    if (error) {
        console.error("Err in initial auth setup, exiting");
        console.error(error_message);
        return;
    }

    console.log("Initial Ikon API established");
    ({ error, error_message, data } = await get_ikon_resorts());
    if (error) {
        console.error("GET ikon resorts failed.");
        console.error(error_message);
        return;
    }

    store_resorts(data);
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
