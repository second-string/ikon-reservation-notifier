const got = require("got");
const fs = require("fs");
const { promisify } = require("util");

const { load_puppeteer_page, get_page_token, build_cookie_str } = require("./puppeteer");
const { build_resort_list_str, prompt_user_and_wait } = require("./cli");
const { ikon_login, get_ikon_reservation_dates, get_ikon_resorts } = require("./ikon_proxy");

// Bind async write to fs.write
const appendFile = promisify(fs.appendFile);
const data_filename = "./reservation_polling_data.txt";

async function main() {
    // Pull opaquely-generated (on a per-visit basis) csrf token by using puppeteer to make any request from an existing page.
    // We don't care about the response success, just the sent token and returned cookies
    const { browser, page } = await load_puppeteer_page("https://account.ikonpass.com/en/login");
    const cookies = await page.cookies();
    const token = await get_page_token(page, browser);
    const cookie_str = build_cookie_str(cookies);
    console.log("Successfully got token and cookies");

    // Use cookie string and csrf token plus account data to log in and get authed cookies. Use cookie jar for all requests from now on
    let { error, error_message, data, cookie_jar: cookieJar } = await ikon_login(token, cookie_str);
    if (error) {
        console.error("Error in POST to log in w/ token and cookies");
        console.error(error.message);
        return;
    }

    // Test our logged-in cookies to make sure we have acces to the api now
    try {
        const res = await got("https://account.ikonpass.com/api/v2/me", { cookieJar });
    } catch (err) {
        console.error("Ikon login failed, did you source setup_env.sh?");
        console.error(err);
        return;
    }

    ({ error, error_message, data } = await get_ikon_resorts(token, cookieJar));
    if (error) {
        console.error("GET ikon resorts failed.");
        console.error(error_message);
        return;
    }

    // Add in our custom indexin to disply a nicely-numbered list to the user
    let i = 1;
    for (const resort of data) {
        // We only want to assign indices to resorts available for monitoring
        if (resort.reservations_enabled)
        {
            resort.custom_index = i;
            i++;
        }
    }

    // Validate user resort choice
    const prompt = build_resort_list_str(data);
    let val = -1;
    const success_criteria = (response) => !isNaN(response) && response >= 1 && response <= i - 1;
    while (val < 1) {
        try {
            val = await prompt_user_and_wait(prompt, success_criteria);
        } catch (err) {
            console.error("Invalid choice, please enter the number corresponding to your chosen resort.");
            val = -1;
        }
    }

    const chosen_resort = data.find(x => x.custom_index == val);
    console.log(`Chosen resort: ${chosen_resort.name}\n`);

    // Validate user date choice (roughly)
    const simple_date_regex = /^[0-9]{2}\/[0-9]{2}\/[0-9]{2,4}$/
    val = -1;
    while (val < 0) {
        try {
            val = await prompt_user_and_wait("Enter the date (MM/dd/yy) that you would like to monitor for reservations:\n\nDate: ", (x) => simple_date_regex.test(x));
        } catch (err) {
            console.error("Invalid date");
            val = -1;
        }
    }

    console.log(`Chosen date: ${val}\n`);

    // Get ikon reservation data for this specific resort
    let reservation_info = await get_ikon_reservation_dates(chosen_resort.id, token, cookieJar);

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

    let chosen_date = new Date(val);
    chosen_date.setHours(0, 0, 0, 0);

    // email, resort id, reservation date, current date
    const polling_data = `${process.env.IKON_USERNAME},${chosen_resort.id},${chosen_date.getTime()},${Date.now()}\n`;
    await appendFile(data_filename, polling_data);
    if (closed_dates.find(x => x.getTime() == chosen_date.getTime())) {
        console.log("Resort is closed on that date.");
    } else if (unavailable_dates.find(x => x.getTime() == chosen_date.getTime())) {
        console.log("Reservations full, setting check");
    } else {
        console.log("Reservations available for that date, go to ikonpass.com to reserve.");
    }
}

main()
	.catch(e => {
		console.error("Uncaught exception when running main()");
		console.error(e);
		process.exit(1);
	});


// todo :: get user id from /me call and use that to only show rezzy info from data array returned from resort-specific rezzy request
// todo :: double check closed and unavail lists - it looks like post-season closed dates are still in unavail list
