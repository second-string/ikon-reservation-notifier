const got = require("got");
const { CookieJar }= require("tough-cookie");

const { load_puppeteer_page, get_page_token, build_cookie_str } = require("./puppeteer");

let browser;
let page;
let token;
let cookie_jar;

async function load_token_and_cookies() {
    ({ browser, page } = await load_puppeteer_page("https://account.ikonpass.com/en/login"));
    const cookies = await page.cookies();

    // Set global token
    token = await get_page_token(page, browser);
    const cookie_str = build_cookie_str(cookies);
    console.log("Successfully got token and cookies");

    // Use cookie string and csrf token plus account data to log in and get authed cookies. Use cookie jar for all requests from now on
    let { error, error_message, data } = await ikon_login(token, cookie_str);
    if (error) {
        console.error("Error in POST to log in w/ token and cookies");
        console.error(error.message);
    }

    return {
        error,
        error_message,
        data
    };
}

async function test_ikon_token_and_cookies() {
    let success = true;
    try {
        const res = await got("https://account.ikonpass.com/api/v2/me", { cookieJar: cookie_jar, ignoreInvalidCookies: true });
    } catch (err) {
        console.error("Ikon login failed, did you source setup_env.sh?");
        console.error(err);
        success = false;
    }

    return success;
}

async function ikon_login(token, cookie_str) {
    // Have to add token header as a pre-hook because setting it in opts will overwrite all other headers.
    // Supply cookies as hand-built str b/c cookie store wasn't working, but really shouldn't need to this way
    const token_instance = got.extend({
        hooks: {
            beforeRequest: [
                options => {
                    options.headers["x-csrf-token"] = token;
                    options.headers["Cookie"] = cookie_str;
                }
            ]
        }
    });

    // Provide empty cookieJar so we save all of the logged-in cookies on response and can use that going forward
    // ignoreInvalidCookies SUPER important, Ikon's CDN Incapsula injects malformed cookies on purpose to defeat
    // bots / scrapers because browsers just disregard them. The NODE_OPTIONS env var must also be set to --insecure-http-parser
    // otherwise it'll choke before it even gets to got's cookie parsing
    cookie_jar = new CookieJar();
    const opts = {
        throwHttpErrors: false,
        method: "PUT",
        json: {
            "email": process.env.IKON_USERNAME,
            "password": process.env.IKON_PASSWORD
        },
        cookieJar: cookie_jar,
        ignoreInvalidCookies: true
    };

    let res;
    let error;
    let error_message = null;
    try {
        res = await token_instance("https://account.ikonpass.com/session", opts);
        error = !(res.statusCode >= 200 && res.statusCode <= 299);
    } catch (err) {
        console.error("Error POSTing login creds");
        console.error(err);
        error = true;
        error_message = "shit";
    }

    return {
        error,
        error_message: error_message, 
        data: null,
        cookie_jar
    };
}

async function get_ikon_reservation_dates(resort_id) {
    const token_instance = got.extend({
        hooks: {
            beforeRequest: [
                options => {
                    options.headers["x-csrf-token"] = token;
                }
            ]
        }
    });

    // See comment in ikon_login for reasoning behind invalid cookies
    const opts = {
        throwdHttpErrors: false,
        method: "GET",
        responseType: "json",
        cookieJar: cookie_jar,
        ignoreInvalidCookies: true
    };

    let res;
    let data;
    let error;
    try {
        res = await token_instance(`https://account.ikonpass.com/api/v2/reservation-availability/${resort_id}`, opts);
        data = res.body.data;
        error = !(res.statusCode >= 200 && res.statusCode <= 299);
    } catch (err) {
        error = true;
        error_message = err.message;
    }

    // We've most likely be deauthed, reload token/cookies and try again
    if (res.statusCode == 401) {
        console.log("Attemtping to reload token/cookies in middle of notification saving due to expiration...");
        let { reload_error, reload_error_message, reload_data } = await load_token_and_cookies();
        if (reload_error) {
            error = true;
            error_message = "Tried to reload token/cookies after 401 but that call failed:\n";
            error_message += reload_error_message;
        }

        // Test our logged-in cookies to make sure we have acces to the api now
        const success = await test_ikon_token_and_cookies();
        if (!success)
        {
            error = true;
            error_message = "Tried to reload token/cookies after 401. First reload call worked, but test call to /me failed";
        }
    }

    return {
        error,
        error_message: error ? error_message : null,
        data: error ? null : data
    };
}

async function get_ikon_resorts() {
    const token_instance = got.extend({
        hooks: {
            beforeRequest: [
                options => {
                    options.headers["x-csrf-token"] = token;
                }
            ]
        }
    });

    // See comment in ikon_login for reasoning behind invalid cookies
    const opts = {
        throwdHttpErrors: false,
        method: "GET",
        responseType: "json",
        cookieJar: cookie_jar,
        ignoreInvalidCookies: true
    };

    const res = await token_instance("https://account.ikonpass.com/api/v2/resorts", opts);
    const data = res.body.data;
    const error = !(res.statusCode >= 200 && res.statusCode <= 299);

    return {
        error,
        error_message: error ? res.body : null,
        data: error ? null : data
    };
}

module.exports = {
    load_token_and_cookies,
    test_ikon_token_and_cookies,
    get_ikon_reservation_dates,
    get_ikon_resorts
};
