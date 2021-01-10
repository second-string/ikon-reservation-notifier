const readline = require("readline");

function build_resort_list_str(resorts) {
    let ret = `Choose which resort you would like to monitor for open reservations:\n\n`;
    let available_resorts = "";
    let non_available_resorts = "";
    let non_reservation_resorts = "";
    for (const resort of resorts) {
        if (resort.reservations_enabled) {
            available_resorts += `${resort.custom_index}: ${resort.name}\n`;
        } else if (resort.reservation_system_url != ""){
            non_available_resorts += `${resort.name}\n`;
        } else {
            non_reservation_resorts += `${resort.name}\n`;
        }
    }

    ret += available_resorts;
    ret += "\n";
    ret += "Resorts unavailable for reservation monitoring (they use their own reservation system):\n\n"
    ret += non_available_resorts;
    ret += "\n";
    ret += "Resorts that do not require reservations this season:\n\n";
    ret += non_reservation_resorts;
    ret += "\n";
    ret += "Resort: ";

    return ret;
}

function prompt_user_and_wait(prompt, success_criteria) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve, reject) => {
        rl.question(prompt, response => {
            rl.close();
            if (success_criteria(response)) {
                resolve(response);
            } else {
                reject(-1);
            }
        });
    });
}

module.exports = {
    build_resort_list_str,
    prompt_user_and_wait
};
