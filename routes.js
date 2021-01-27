const { Router } = require("express");
const fs = require("fs");
const { promisify } = require("util");

const { refresh_and_test_auth, get_ikon_reservation_dates } = require("./ikon_proxy");
const { send_confirmation_email } = require("./sendgrid_proxy.js");

// Bind async write to fs.write
const appendFile = promisify(fs.appendFile);
const data_filename = "./reservation_polling_data.txt";

// Globals (for now at least)
let resorts = [];

function store_resorts(new_resorts) {
    resorts = new_resorts;
}

function set_routes() {
    const router = Router();

    router.get("/health", (req, res) => res.send("Surviving not thriving"));

    router.get("/", (req, res) => {
        res.render("home");
    });

    router.get("/resorts", (req, res) => {
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

    router.get("/reservation-dates", (req, res) => {
        const resort_id_str = req.query.resort;
        if (!resort_id_str) {
            return res.status(400).send("You need to choose a resort first.");
        }

        const resort_id = parseInt(resort_id_str);

        const resort = resorts.filter(x => x.id == resort_id)[0];
        res.render("reservation-dates", { resort });
    });

    router.post("/save-notification", async (req, res) => {
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
            let { error, error_message, data } = await refresh_and_test_auth();
            if (error) {
                console.error("Failed refreshing auth after failing reservation dates request:");
                console.error(reservation_info.error_message + "\n");
                console.error(error_message);
                return res.status(500);
            } else {
                // Try call again after re authing
                reservation_info = await get_ikon_reservation_dates(resort_id);
                if (reservation_info.error) {
                    console.error("Second error for reservation info even after reauthing");
                    console.error(reservation_info.error_message);
                    return res.status(500);
                }
            }
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

                const resort = resorts.find(x => x.id == resort_id);
                await send_confirmation_email(email, resort == undefined ? resort_id_str : resort.name, chosen_date, now);
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

    router.post("/refresh-ikon-auth", async (req, res) => {
        // Get call reservation data function with resort id to force auth refresh
        console.log("Starting refresh...");
        let { error, error_message, data } = await refresh_and_test_auth();
        if (error) {
            console.error(error_message);
            return res.status(500).send();
        }

        return res.status(204).send();
    });

    return router;
}

module.exports = {
    set_routes,
    store_resorts
};
