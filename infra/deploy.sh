#!/usr/bin/env bash
# Deploys the app from a laptop (DECISIONS.md #16): build, terraform apply (asks for confirmation),
# upload the frontend, invalidate the cache, smoke test. Run from the repository root.
set -euo pipefail

npm ci --ignore-scripts

# Always this account, regardless of the shell's default profile.
export AWS_PROFILE=btc-updown AWS_REGION=eu-central-1 AWS_PAGER=""
account=$(aws sts get-caller-identity --query Account --output text)
# Make sure the state bucket belongs to this account.
aws s3api head-bucket --bucket "btc-updown-tfstate-$account" --expected-bucket-owner "$account"

npm run build -w api
terraform -chdir=infra init -input=false -backend-config="bucket=btc-updown-tfstate-$account"
terraform -chdir=infra apply

url=$(terraform -chdir=infra output -raw url)
bucket=$(terraform -chdir=infra output -raw web_bucket)
distribution=$(terraform -chdir=infra output -raw distribution_id)

npm run build -w web
# Hashed assets first and never deleted, so a cached old index.html still finds its files.
# ponytail: old assets accumulate (a few hundred kB per deploy); prune by hand if it ever matters.
aws s3 sync web/dist/assets "s3://$bucket/assets" --cache-control 'public, max-age=31536000, immutable'
aws s3 sync web/dist "s3://$bucket" --exclude 'assets/*' --cache-control 'no-cache'
aws cloudfront create-invalidation --distribution-id "$distribution" --paths '/*' --query Invalidation.Id --output text

# Smoke test without writes: the price, and the empty state of a new player.
price=$(curl -fsS "$url/api/price")
me=$(curl -fsS "$url/api/me")
[[ $price == *'"price"'* && $me == *'"score":0'* ]] || { echo "Smoke test failed"; exit 1; }
echo "Deployed: $url"
