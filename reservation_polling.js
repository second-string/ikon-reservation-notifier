const fs = require("fs");
const readline = require("readline");
const got = require("got");
const sendgrid = require("@sendgrid/mail");

const dataFilename = "./reservation_polling_data.txt";
const newDataFilename = "./new_reservation_polling_data.txt";

const { load_puppeteer_page, get_page_token, build_cookie_str } = require("./puppeteer");
const { ikon_login, get_ikon_reservation_dates } = require("./ikon_proxy");

sendgrid.setApiKey(process.env.SG_IKON_RESERVATION_KEY);

async function main() {
    const file = fs.createReadStream(dataFilename);
    const new_file = fs.createWriteStream(newDataFilename);

    // Pull opaquely-generated (on a per-visit basis) csrf token by using puppeteer to make any request from an existing page.
    // We don't care about the response success, just the sent token and returned cookies
    const { browser, page } = await load_puppeteer_page("https://account.ikonpass.com/en/login");
    const cookies = await page.cookies();
    const token = await get_page_token(page, browser);
    const cookie_str = build_cookie_str(cookies);
    console.log("Successfully got token and cookies");

    // Use cookie string and csrf token plus account data to log in and get authed cookies. Use cookie jar for all requests from now on
    let { error, error_message, data, cookie_jar } = await ikon_login(token, cookie_str);
    if (error) {
        console.error("Error in POST to log in w/ token and cookies");
        console.error(error.message);
        return;
    }
    console.log("Successfully logged in");

    // Test our logged-in cookies to make sure we have acces to the api now
    try {
        const res = await got("https://account.ikonpass.com/api/v2/me", { cookieJar: cookie_jar, ignoreInvalidCookies: true });
    } catch (err) {
        console.error("Ikon login failed, did you source setup_env.sh?");
        console.error(err);
        return;
    }

    console.log("Successfully tested logged-in cookies");

    let lineData = [];
    const rl = readline.createInterface({
        input: file,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (line.trim() == "") {
            continue;
        }

        lineData = line.split(",");

        // email, resort id, reservation date, current date
        const email = lineData[0];
        const resortId = lineData[1];
        const desiredDate = parseInt(lineData[2], 10);
        const dateSaved = lineData[3];

        // Get ikon reservation data for this specific resort
        let reservation_info = await get_ikon_reservation_dates(resortId, token, cookie_jar);
        
        // Dates need to be zeroed out otherwise comparison fails
        const closed_dates = reservation_info.data[0].closed_dates.map(x => {
            const d = new Date(x);
            d.setHours(0, 0, 0, 0);
            return d;
        });
        const unavailable_dates = reservation_info.data[0].unavailable_dates.map(x => {
            const d = new Date(x);
            d.setHours(0, 0, 0, 0);
            return d;
        });

        let chosen_date = new Date(desiredDate);
        chosen_date.setHours(0, 0, 0, 0);

        if (closed_dates.find(x => x.getTime() == chosen_date.getTime())) {
            console.log("Resort is closed on that date.");
            new_file.write(line);
        } else if (unavailable_dates.find(x => x.getTime() == chosen_date.getTime())) {
            console.log("Reservations still full");
            new_file.write(line);
        } else {
            const end_of_date = chosen_date.toISOString().indexOf('T');
            const pretty_date = chosen_date.toISOString().substr(0, end_of_date);

            const msg = {
                to: email,
                from: "ikonreservationnotifier@brianteam.dev",
                subject: "Your chosen Ikon resort has open reservations!",
                text: `The resort you have been monitoring for open reservations, ${resortId}, now has open spots for ${pretty_date}. This date notification will now be cleared, if you would like to set another one please visit ikonreservations.brianteam.dev again`
            };

            try {
                await sendgrid.send(msg);
                console.log(`Sent email to ${email} for ${resortId}`);
            } catch (e) {
                console.error("Error sending mail;");
                console.error(e);
            }
        }
    }

    new_file.end();

    // Move our new file without any available reservations over the old one to overwrite
    fs.renameSync(dataFilename, dataFilename + ".bkp");
    fs.renameSync(newDataFilename, dataFilename);
}

main()
	.catch(e => {
		console.error("Uncaught exception when running main()");
		console.error(e);
		process.exit(1);
	});
