#!/bin/bash

source setup_env.sh
echo "Running reservation polling script..."
node $PWD/reservation_polling.js
echo "All done."
