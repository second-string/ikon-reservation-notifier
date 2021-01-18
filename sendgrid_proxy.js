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

module.exports = {
    sendgrid_send_message
};
