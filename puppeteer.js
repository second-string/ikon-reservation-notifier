const chrome = require("chrome-remote-interface");
const puppeteer = require("puppeteer");

async function load_puppeteer_page(url) {
    let opts = undefined;
    if (process.env.DEPLOY_STAGE == "PROD") {
        console.log("Specifying executable path for chromium...");
        opts = {
            executablePath: "chromium-browser"
        };
    }

    const browser = await puppeteer.launch(opts);
    const page = await browser.newPage();

    if (process.env.DEV_ENV != "PROD") {
        await page.setDefaultNavigationTimeout(0); 
    }
    await page.goto(url);

    return {
        browser,
        page
    };
}

async function get_page_token(page, browser) {
    const form = await page.$(".amp-sign-in-form.login-form");
    const button = await form.$(".submit.amp-button.primary");

    const token_promise = new Promise((resolve, reject) => {
        page.on("request", (req) => 
            {
                const url = req.url();
                if (url.startsWith("https://account.ikonpass.com/")) {
                    console.log(url);
                    const headers = req.headers();
                    //console.log(headers);
                    if (url.endsWith("/session")) {
                        const token = headers['x-csrf-token'];
                        if (token) {
                            console.log("Got token! Token: " + token);
                            browser.close();
                            resolve(token);
                        }
                    }                
                }
            }
        );
    });

    await button.click();

    return await token_promise;
}

function build_cookie_str(cookies) {
    let cookie_str = "";
    for (const cookie of cookies) {
        cookie_str += cookie.name + "=" + cookie.value + ";";
    }

    return cookie_str;
}

module.exports = {
    load_puppeteer_page,
    get_page_token,
    build_cookie_str
};
