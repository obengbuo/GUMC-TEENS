#!/usr/bin/env bash
# Deploys Bible Name Scramble to AWS and prints the game URL.
# Needs: AWS CLI v2 signed in to your account, and `zip`.  Usage: ./deploy.sh [region]
set -euo pipefail
cd "$(dirname "$0")"

STACK="${STACK_NAME:-bible-name-scramble}"
REGION="${1:-${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}}"

echo "==> Creating/updating AWS resources in $REGION (stack: $STACK)"
aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \
  --template-file infra/template.yaml --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset

out() { aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
FUNCTION="$(out FunctionName)"
URL="$(out GameUrl)"

echo "==> Uploading the game"
ZIP="$(mktemp -d)/app.zip"
(cd app && zip -qr "$ZIP" .)
aws lambda update-function-code --region "$REGION" --function-name "$FUNCTION" --zip-file "fileb://$ZIP" >/dev/null
aws lambda wait function-updated --region "$REGION" --function-name "$FUNCTION"

echo
echo "Game is live:  $URL"
