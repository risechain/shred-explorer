#!/bin/bash

# Test script for verifying ETL connections

echo "===== RISE Shred Explorer ETL System Check ====="
echo "This script will check your environment and connections"
echo ""

# Check for .env file
if [ -f .env ]; then
  echo "✅ .env file found"
  
  # Extract values from .env for display
  DATABASE_URL=$(grep DATABASE_URL .env | cut -d '=' -f2)
  WEBSOCKET_URL=$(grep WEBSOCKET_URL .env | cut -d '=' -f2)
  
  echo "  DATABASE_URL = $DATABASE_URL"
  echo "  WEBSOCKET_URL = $WEBSOCKET_URL"
else
  echo "❌ .env file not found! Please create one from .env.example"
  exit 1
fi

# Check Postgres connection
echo ""
echo "Testing database connection..."
if command -v psql &> /dev/null; then
  # Extract host, port, user, dbname from DATABASE_URL
  DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\).*/\1/p')
  DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
  DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\).*/\1/p')
  DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
  
  echo "  Attempting to connect to PostgreSQL at $DB_HOST:$DB_PORT as $DB_USER"
  
  PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\([^@]*\)@.*/\1/p') psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1" &> /dev/null
  if [ $? -eq 0 ]; then
    echo "✅ Database connection successful!"
  else
    echo "❌ Database connection failed. Check your PostgreSQL server and DATABASE_URL."
    exit 1
  fi
else
  echo "  psql command not found. Cannot test database connection directly."
  echo "  Will rely on application's connection test instead."
fi

# Test WebSocket connectivity
echo ""
echo "Testing WebSocket connectivity..."
WS_HOST=$(echo $WEBSOCKET_URL | sed -n 's/.*:\/\/\([^:/]*\).*/\1/p')
echo "  Checking if host $WS_HOST is reachable..."

if ping -c 1 $WS_HOST &> /dev/null; then
  echo "✅ Host $WS_HOST is reachable!"
else
  echo "⚠️  Host $WS_HOST did not respond to ping. This may not be an error if the host blocks ICMP."
fi

# Try sending a JSON-RPC request to the WebSocket endpoint
echo ""
echo "Testing WebSocket protocol with a simple request..."

# Use websocat if available (need to install with: brew install websocat)
if command -v websocat &> /dev/null; then
  echo "  Using websocat to test WebSocket connection..."
  
  # Try a simple request with 5 second timeout
  REQUEST='{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
  timeout 5 websocat -n1 "$WEBSOCKET_URL" <<< "$REQUEST" 1>/dev/null 2>&1
  
  if [ $? -eq 0 ]; then
    echo "✅ Successfully connected to WebSocket endpoint!"
  else
    echo "⚠️  Could not connect to WebSocket endpoint with websocat."
    echo "  This might be because websocat timed out or the endpoint doesn't support the eth_chainId method."
  fi
else
  echo "  websocat command not found. Cannot directly test WebSocket protocol."
  echo "  To install: brew install websocat"
  echo "  Will rely on the application's WebSocket test instead."
fi

echo ""
echo "All tests completed. If all checks passed, try running 'cargo run' now."
echo "If you still experience issues, check the detailed logs that will be displayed."