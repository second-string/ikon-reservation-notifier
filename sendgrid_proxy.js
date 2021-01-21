const sendgrid = require("@sendgrid/mail");

sendgrid.setApiKey(process.env.SG_IKON_RESERVATION_KEY);

async function sendgrid_send_message(msg) {
    const success = true;
    try {
        await sendgrid.send(msg);
    } catch (e) {
        success = false;
        console.error("Sendgrid error:");
        console.error(e);
    }

    return success;
}

async function send_confirmation_email(email, resort_id, chosen_date, now) {
    const end_of_date = chosen_date.toISOString().indexOf('T');
    const pretty_date = chosen_date.toISOString().substr(0, end_of_date);
    const resort = resorts.find(x => x.id == resort_id);

    const msg = {
        to: email,
        from: "ikonreservationnotifier@brianteam.dev",
        subject: "Confirmation of Ikon reservation notification",
        text: `Notification saved for ${resort == undefined ? resortIdStr : resort.name} on ${pretty_date}. You'll receive an email at this address if a reservation slot opens up before that date, no more action is needed.`
    };

    const email_success = await sendgrid_send_message(msg);
    if (email_success) {
        console.log(`Sent confirmation email to ${email} for ${resort == undefined ? resortIdStr : resort.name} on ${chosen_date.toISOString()}`);
    } else {
        console.error(`Error sending confirmation email to ${email} for ${resort == undefined ? resortIdStr : resort.name} for ${chosen_date.toISOString()}!`);
    }
}

module.exports = {
    sendgrid_send_message,
    send_confirmation_email
};
