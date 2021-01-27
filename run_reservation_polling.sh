#!/bin/bash
DIR=/home/pi/ikon-reservation-notifier

source $DIR/setup_env.sh
echo "Running reservation polling script..."
node $DIR/reservation_polling.js
echo "All done."
echo "Refreshing server's auth..."
curl -X POST "https://ikonreservations.brianteam.dev/refresh-ikon-auth"
echo "done."
