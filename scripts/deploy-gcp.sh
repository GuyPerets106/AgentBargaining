#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0416863741}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-negotiation-lab}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-negotiation-app-sa@gen-lang-client-0416863741.iam.gserviceaccount.com}"
SOURCE_DIR="${SOURCE_DIR:-$(pwd)}"
BUCKET_NAME="${SESSION_BUCKET_NAME:-negotiation-session-logs}"
BUCKET_PREFIX="${SESSION_BUCKET_PREFIX:-sessions}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"

if [[ ! -f "${SOURCE_DIR}/package.json" ]]; then
  echo "ERROR: SOURCE_DIR does not look like the repo root: ${SOURCE_DIR}" >&2
  exit 1
fi

echo "Deploying ${SERVICE_NAME} to Cloud Run in ${REGION} (project ${PROJECT_ID})"

gcloud config set project "${PROJECT_ID}"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com storage.googleapis.com

ENV_VARS=(
  "GOOGLE_AI_STUDIO_API_KEY=${GOOGLE_AI_STUDIO_API_KEY:-}"
  "ADMIN_USER=${ADMIN_USER}"
  "ADMIN_PASSWORD=${ADMIN_PASSWORD}"
  "SESSION_BUCKET_NAME=${BUCKET_NAME}"
  "SESSION_BUCKET_PREFIX=${BUCKET_PREFIX}"
)

if [[ -z "${GOOGLE_AI_STUDIO_API_KEY:-}" ]]; then
  echo "WARNING: GOOGLE_AI_STUDIO_API_KEY is not set in the environment." >&2
  echo "You can set it inline: GOOGLE_AI_STUDIO_API_KEY=... ./scripts/deploy-gcp.sh" >&2
fi

gcloud run deploy "${SERVICE_NAME}" \
  --source "${SOURCE_DIR}" \
  --region "${REGION}" \
  --allow-unauthenticated \
  --service-account "${SERVICE_ACCOUNT}" \
  --set-env-vars "$(IFS=,; echo "${ENV_VARS[*]}")"

echo "Done. Fetch the URL with: gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format='value(status.url)'"
