#!/bin/bash

# should exit on errors
set -e

# Initialize variables
join_network=false
join_value=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --join)
            join_network=true
            join_value="$2"
            shift # Remove argument name
            shift # Remove argument value
            ;;
        *) # Preserve unknown arguments
            break
            ;;
    esac
done

if $join_network; then
	echo "-- User requested to join the logstore network --"
  CONTAINER_ALREADY_STARTED="/firstrun/CONTAINER_ALREADY_STARTED_PLACEHOLDER"
  if [ ! -e $CONTAINER_ALREADY_STARTED ]; then
      echo "-- First container startup. Joining the network. --"
      logstore-broker join "$join_value" -y -m "$BROKER_METADATA" &&
      touch $CONTAINER_ALREADY_STARTED
  else
      echo "-- Not first container startup. No need to join. --"
  fi

fi

echo "-- Starting the broker node --"
exec logstore-broker start
