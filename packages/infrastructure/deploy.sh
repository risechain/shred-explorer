#!/bin/bash
set -e

# Load environment variables
if [ -f .env ]; then
    echo "Loading environment variables from .env file..."
    export $(grep -v '^#' .env | xargs)
else
    echo "No .env file found. Using environment variables or defaults..."
fi

# Check if AWS SSO token is valid, if not, login
echo "Checking AWS SSO session..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo "No valid AWS SSO session found. Logging in..."
    aws sso login --profile "${AWS_PROFILE:-default}"
    
    if [ $? -ne 0 ]; then
        echo "AWS SSO login failed. Please check your AWS CLI configuration."
        exit 1
    fi
    
    echo "Successfully logged in with AWS SSO."
else
    echo "Using existing AWS SSO session."
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Bootstrap CDK in the account if needed
echo "Bootstrapping CDK (if needed)..."
npx cdk bootstrap

# Build the project
echo "Building project..."
npm run build

# Synthesize the CloudFormation templates
echo "Synthesizing CloudFormation templates..."
npm run synth

# Deploy the stacks
echo "Deploying infrastructure..."
npx cdk deploy --all --require-approval never

echo "Deployment completed!"