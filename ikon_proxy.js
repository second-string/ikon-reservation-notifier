const got = require("got");
const { CookieJar }= require("tough-cookie");

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
    const cookie_jar = new CookieJar();
    const opts = {
        throwHttpErrors: false,
        method: "PUT",
        json: {
            "email": process.env.IKON_USERNAME,
            "password": process.env.IKON_PASSWORD
        },
        cookieJar: cookie_jar
    };

    const res = await token_instance("https://account.ikonpass.com/session", opts);
    const error = !(res.statusCode >= 200 && res.statusCode <= 299);
    return {
        error,
        error_message: error ? res.body : null,
        data: null,
        cookie_jar
    };
}

async function get_ikon_reservation_dates(resort_id, token, cookie_jar) {
    const token_instance = got.extend({
        hooks: {
            beforeRequest: [
                options => {
                    options.headers["x-csrf-token"] = token;
                }
            ]
        }
    });

    const opts = {
        throwdHttpErrors: false,
        method: "GET",
        responseType: "json",
        cookieJar: cookie_jar
    };

    const res = await token_instance(`https://account.ikonpass.com/api/v2/reservation-availability/${resort_id}`, opts);
    const data = res.body.data;
    const error = !(res.statusCode >= 200 && res.statusCode <= 299);

    return {
        error,
        error_message: error ? res.body : null,
        data: error ? null : data
    };
}

async function get_ikon_resorts(token, cookie_jar) {
    const token_instance = got.extend({
        hooks: {
            beforeRequest: [
                options => {
                    options.headers["x-csrf-token"] = token;
                }
            ]
        }
    });

    const opts = {
        throwdHttpErrors: false,
        method: "GET",
        responseType: "json",
        cookieJar: cookie_jar
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
    ikon_login,
    get_ikon_reservation_dates,
    get_ikon_resorts
};
