#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GrainShield Go/No-Go Validation Script
# Runs 10 pre-deploy checks against the platform before any production release.
# Exit code 0 = GO, non-zero = NO-GO.
#
# Usage:
#   ./scripts/go-no-go.sh [--env staging|production] [--verbose]
#
# Required tools: go, node/npm, docker, kubectl, curl, jq, bc
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

ENVIRONMENT="${1:---env}"
VERBOSE=false
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
TOTAL_CHECKS=10

GO_SERVICES=(
  "services/farmer-service"
  "services/policy-service"
  "services/payment-service"
  "services/price-service"
  "services/risk-service"
  "services/warehouse-service"
  "services/notification-service"
  "services/ussd-service"
)

CRITICAL_COVERAGE_PACKAGES=(
  "services/payment-service"
  "services/policy-service"
  "services/risk-service/premium"
)

MIN_COVERAGE=80
TARGET_COVERAGE=90
CRITICAL_COVERAGE=100

# ─── Parse Arguments ────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENVIRONMENT="${2:-staging}"
      shift 2
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# ─── Output Helpers ──────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo -e "  ${GREEN}✓ PASS${NC}  $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo -e "  ${RED}✗ FAIL${NC}  $1"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  echo -e "  ${YELLOW}⚠ WARN${NC}  $1"
}

info() {
  if [ "${VERBOSE}" = true ]; then
    echo -e "  ${CYAN}ℹ INFO${NC}  $1"
  fi
}

header() {
  echo ""
  echo -e "${BOLD}[$1/${TOTAL_CHECKS}] $2${NC}"
  echo "────────────────────────────────────────"
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 1: All Go services compile without errors
# ─────────────────────────────────────────────────────────────────────────────
check_1_compilation() {
  header 1 "Go Services Compilation"
  local ALL_PASS=true

  for svc in "${GO_SERVICES[@]}"; do
    SVC_NAME=$(basename "${svc}")
    if [ -d "${svc}" ]; then
      pushd "${svc}" > /dev/null
      if go build ./... 2>/dev/null; then
        info "${SVC_NAME}: compiles"
      else
        fail "${SVC_NAME} failed to compile"
        ALL_PASS=false
      fi
      popd > /dev/null
    else
      fail "${SVC_NAME} directory not found"
      ALL_PASS=false
    fi
  done

  if [ "${ALL_PASS}" = true ]; then
    pass "All 8 Go services compile without errors"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2: All Go services pass gofmt (zero unformatted files)
# ─────────────────────────────────────────────────────────────────────────────
check_2_formatting() {
  header 2 "Code Formatting (gofmt)"
  local ALL_PASS=true

  for svc in "${GO_SERVICES[@]}"; do
    SVC_NAME=$(basename "${svc}")
    if [ -d "${svc}" ]; then
      UNFORMATTED=$(gofmt -l "${svc}" 2>/dev/null || echo "")
      if [ -n "${UNFORMATTED}" ]; then
        fail "${SVC_NAME} has unformatted files:"
        echo "${UNFORMATTED}" | head -5
        ALL_PASS=false
      else
        info "${SVC_NAME}: formatted"
      fi
    fi
  done

  # Also check shared pkg
  UNFORMATTED=$(gofmt -l "pkg" 2>/dev/null || echo "")
  if [ -n "${UNFORMATTED}" ]; then
    fail "pkg/ has unformatted files"
    ALL_PASS=false
  fi

  if [ "${ALL_PASS}" = true ]; then
    pass "All Go code passes gofmt"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 3: All unit tests pass across all services
# ─────────────────────────────────────────────────────────────────────────────
check_3_tests() {
  header 3 "Unit Tests (all services)"
  local ALL_PASS=true

  for svc in "${GO_SERVICES[@]}"; do
    SVC_NAME=$(basename "${svc}")
    if [ -d "${svc}" ]; then
      pushd "${svc}" > /dev/null
      if go test -race -short ./... > /dev/null 2>&1; then
        info "${SVC_NAME}: all tests pass"
      else
        fail "${SVC_NAME} has failing tests"
        ALL_PASS=false
      fi
      popd > /dev/null
    fi
  done

  if [ "${ALL_PASS}" = true ]; then
    pass "All unit tests pass across all services"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 4: Coverage gates (80% min, 90% target, 100% on critical paths)
# ─────────────────────────────────────────────────────────────────────────────
check_4_coverage() {
  header 4 "Test Coverage Gates"
  local ALL_PASS=true
  local BELOW_TARGET=false

  for svc in "${GO_SERVICES[@]}"; do
    SVC_NAME=$(basename "${svc}")
    if [ -d "${svc}" ]; then
      pushd "${svc}" > /dev/null
      COVERAGE_OUT=$(go test -coverprofile=coverage.out ./... 2>/dev/null || echo "")
      if [ -f coverage.out ]; then
        COV=$(go tool cover -func=coverage.out 2>/dev/null | grep total | awk '{print $3}' | tr -d '%' || echo "0")

        if (( $(echo "${COV} < ${MIN_COVERAGE}" | bc -l 2>/dev/null || echo "1") )); then
          fail "${SVC_NAME} coverage ${COV}% is below minimum ${MIN_COVERAGE}%"
          ALL_PASS=false
        elif (( $(echo "${COV} < ${TARGET_COVERAGE}" | bc -l 2>/dev/null || echo "0") )); then
          warn "${SVC_NAME} coverage ${COV}% is below target ${TARGET_COVERAGE}%"
          BELOW_TARGET=true
        else
          info "${SVC_NAME}: ${COV}% coverage"
        fi
        rm -f coverage.out
      else
        fail "${SVC_NAME} failed to generate coverage report"
        ALL_PASS=false
      fi
      popd > /dev/null
    fi
  done

  # Critical path check: premium calculator must be 100%
  if [ -d "services/risk-service/premium" ]; then
    pushd "services/risk-service" > /dev/null
    go test -coverprofile=premium_cov.out ./premium/... 2>/dev/null || true
    if [ -f premium_cov.out ]; then
      PCOV=$(go tool cover -func=premium_cov.out 2>/dev/null | grep total | awk '{print $3}' | tr -d '%' || echo "0")
      if [ "${PCOV}" != "100.0" ]; then
        fail "Premium calculator coverage ${PCOV}% must be 100%"
        ALL_PASS=false
      else
        info "Premium calculator: 100% coverage"
      fi
      rm -f premium_cov.out
    fi
    popd > /dev/null
  fi

  if [ "${ALL_PASS}" = true ] && [ "${BELOW_TARGET}" = false ]; then
    pass "All coverage gates met (min ${MIN_COVERAGE}%, target ${TARGET_COVERAGE}%)"
  elif [ "${ALL_PASS}" = true ]; then
    pass "Minimum coverage gate ${MIN_COVERAGE}% met (some services below ${TARGET_COVERAGE}% target)"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 5: All Docker images build successfully
# ─────────────────────────────────────────────────────────────────────────────
check_5_docker_build() {
  header 5 "Docker Image Builds"
  local ALL_PASS=true

  if ! command -v docker &> /dev/null; then
    warn "Docker not available. Skipping image build check."
    return
  fi

  for svc in "${GO_SERVICES[@]}"; do
    SVC_NAME=$(basename "${svc}")
    if [ -f "${svc}/Dockerfile" ]; then
      info "Building ${SVC_NAME}..."
      if docker build -t "go-no-go-check:${SVC_NAME}" "${svc}" --quiet > /dev/null 2>&1; then
        info "${SVC_NAME}: image builds"
        docker rmi "go-no-go-check:${SVC_NAME}" > /dev/null 2>&1 || true
      else
        fail "${SVC_NAME} Docker image failed to build"
        ALL_PASS=false
      fi
    else
      fail "${SVC_NAME} has no Dockerfile"
      ALL_PASS=false
    fi
  done

  if [ "${ALL_PASS}" = true ]; then
    pass "All 8 Docker images build successfully"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 6: No secrets or credentials in codebase
# ─────────────────────────────────────────────────────────────────────────────
check_6_no_secrets() {
  header 6 "Secret and Credential Scan"
  local ALL_PASS=true

  # Patterns that indicate hardcoded secrets
  SECRET_PATTERNS=(
    "POSTGRES_PASSWORD="
    "MPESA_CONSUMER_KEY="
    "MPESA_CONSUMER_SECRET="
    "AT_API_KEY="
    "SNYK_TOKEN="
    "JWT_PRIVATE_KEY="
    "ENCRYPTION_KEY="
    "AWS_SECRET_ACCESS_KEY="
  )

  for pattern in "${SECRET_PATTERNS[@]}"; do
    # Search in Go, TypeScript, and YAML files (excluding node_modules, .env.example, go.sum)
    MATCHES=$(grep -r --include="*.go" --include="*.ts" --include="*.tsx" \
      --include="*.yaml" --include="*.yml" \
      --exclude-dir="node_modules" --exclude-dir=".next" \
      --exclude-dir=".git" --exclude="*.example" --exclude="go.sum" \
      -l "${pattern}" . 2>/dev/null | grep -v ".env.example" | grep -v "docker-compose" | grep -v ".github/workflows" || echo "")

    if [ -n "${MATCHES}" ]; then
      fail "Potential hardcoded secret '${pattern}' found in:"
      echo "${MATCHES}" | head -3
      ALL_PASS=false
    fi
  done

  # Check for .env files (should never be committed)
  ENV_FILES=$(find . -name ".env" -not -name ".env.example" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null || echo "")
  if [ -n "${ENV_FILES}" ]; then
    fail ".env files found in repository (should be in .gitignore):"
    echo "${ENV_FILES}"
    ALL_PASS=false
  fi

  if [ "${ALL_PASS}" = true ]; then
    pass "No hardcoded secrets or credentials detected"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 7: Kubernetes manifests are valid and complete
# ─────────────────────────────────────────────────────────────────────────────
check_7_k8s_manifests() {
  header 7 "Kubernetes Manifest Validation"
  local ALL_PASS=true

  K8S_SERVICES=(
    "infrastructure/farmer-service"
    "infrastructure/policy-service"
    "infrastructure/payment-service"
    "infrastructure/price-service"
    "infrastructure/risk-service"
    "infrastructure/warehouse-service"
    "infrastructure/notification-service"
  )

  for svc_dir in "${K8S_SERVICES[@]}"; do
    SVC_NAME=$(basename "${svc_dir}")

    if [ ! -d "${svc_dir}" ]; then
      fail "${SVC_NAME} K8s manifest directory missing"
      ALL_PASS=false
      continue
    fi

    # Check for required files
    YAML_FILE="${svc_dir}/${SVC_NAME}.yaml"
    if [ ! -f "${YAML_FILE}" ]; then
      fail "${SVC_NAME} deployment manifest missing"
      ALL_PASS=false
    else
      # Verify it contains required resources: Rollout, Service, Ingress, NetworkPolicy
      for resource in "kind: Rollout" "kind: Service" "kind: Ingress" "kind: NetworkPolicy"; do
        if ! grep -q "${resource}" "${YAML_FILE}" 2>/dev/null; then
          fail "${SVC_NAME} manifest missing ${resource}"
          ALL_PASS=false
        fi
      done

      # Verify canary strategy is defined
      if ! grep -q "canary:" "${YAML_FILE}" 2>/dev/null; then
        fail "${SVC_NAME} manifest missing canary strategy"
        ALL_PASS=false
      fi

      # Verify resource limits are set
      if ! grep -q "limits:" "${YAML_FILE}" 2>/dev/null; then
        fail "${SVC_NAME} manifest missing resource limits"
        ALL_PASS=false
      fi

      # Verify health probes
      if ! grep -q "livenessProbe:" "${YAML_FILE}" 2>/dev/null; then
        fail "${SVC_NAME} manifest missing livenessProbe"
        ALL_PASS=false
      fi
      if ! grep -q "readinessProbe:" "${YAML_FILE}" 2>/dev/null; then
        fail "${SVC_NAME} manifest missing readinessProbe"
        ALL_PASS=false
      fi

      info "${SVC_NAME}: manifest valid"
    fi

    # Check for HPA
    if [ ! -f "${svc_dir}/hpa.yaml" ]; then
      warn "${SVC_NAME} missing HPA manifest"
    fi

    # Check for alerts
    if [ ! -f "${svc_dir}/alerts.yaml" ]; then
      warn "${SVC_NAME} missing Prometheus alert rules"
    fi
  done

  if [ "${ALL_PASS}" = true ]; then
    pass "All Kubernetes manifests are valid and complete"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 8: Frontend builds without errors
# ─────────────────────────────────────────────────────────────────────────────
check_8_frontend_build() {
  header 8 "Frontend Build (Next.js)"
  local ALL_PASS=true

  if [ ! -d "grainshield-app" ]; then
    fail "grainshield-app directory not found"
    return
  fi

  pushd "grainshield-app" > /dev/null

  # Check package.json exists
  if [ ! -f "package.json" ]; then
    fail "package.json missing"
    ALL_PASS=false
  fi

  # Install deps if needed
  if [ ! -d "node_modules" ]; then
    info "Installing dependencies..."
    npm ci --silent 2>/dev/null || true
  fi

  # ESLint check
  if npx next lint --quiet 2>/dev/null; then
    info "ESLint: passed"
  else
    warn "ESLint warnings detected"
  fi

  # TypeScript check
  if npx tsc --noEmit 2>/dev/null; then
    info "TypeScript: no errors"
  else
    fail "TypeScript type errors detected"
    ALL_PASS=false
  fi

  # Build check
  if npx next build 2>/dev/null; then
    info "Next.js build: successful"
  else
    fail "Next.js build failed"
    ALL_PASS=false
  fi

  popd > /dev/null

  if [ "${ALL_PASS}" = true ]; then
    pass "Frontend builds and passes typecheck"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 9: Deploy window validation (production only)
# ─────────────────────────────────────────────────────────────────────────────
check_9_deploy_window() {
  header 9 "Deploy Window Validation"

  if [ "${ENVIRONMENT}" != "production" ]; then
    pass "Staging deploy: no window restriction"
    return
  fi

  # EAT = UTC+3
  CURRENT_DAY=$(TZ="Africa/Nairobi" date +%u)
  CURRENT_HOUR=$(TZ="Africa/Nairobi" date +%H)
  CURRENT_TIME=$(TZ="Africa/Nairobi" date "+%A %H:%M EAT")

  info "Current time: ${CURRENT_TIME}"

  # Tuesday = 2, Thursday = 4
  if [ "${CURRENT_DAY}" != "2" ] && [ "${CURRENT_DAY}" != "4" ]; then
    fail "Production deploys only on Tuesday and Thursday (current: $(TZ='Africa/Nairobi' date +%A))"
    return
  fi

  if [ "${CURRENT_HOUR}" -lt 10 ] || [ "${CURRENT_HOUR}" -ge 14 ]; then
    fail "Production deploys only between 10:00 and 14:00 EAT (current: ${CURRENT_HOUR}:$(TZ='Africa/Nairobi' date +%M))"
    return
  fi

  pass "Deploy window valid: ${CURRENT_TIME}"
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 10: CI/CD pipeline files exist and are valid YAML
# ─────────────────────────────────────────────────────────────────────────────
check_10_pipeline_files() {
  header 10 "CI/CD Pipeline Configuration"
  local ALL_PASS=true

  REQUIRED_WORKFLOWS=(
    ".github/workflows/ci.yml"
    ".github/workflows/cd-staging.yml"
    ".github/workflows/cd-production.yml"
    ".github/workflows/security-scan.yml"
  )

  for wf in "${REQUIRED_WORKFLOWS[@]}"; do
    if [ ! -f "${wf}" ]; then
      fail "Missing workflow: ${wf}"
      ALL_PASS=false
    else
      # Basic YAML validation (check for required fields)
      if grep -q "name:" "${wf}" && grep -q "on:" "${wf}" && grep -q "jobs:" "${wf}"; then
        info "${wf}: valid structure"
      else
        fail "${wf}: missing required YAML fields (name, on, jobs)"
        ALL_PASS=false
      fi
    fi
  done

  # Verify CI pipeline has all required gates
  if [ -f ".github/workflows/ci.yml" ]; then
    CI_FILE=".github/workflows/ci.yml"
    for gate in "lint" "test" "docker" "snyk" "trivy"; do
      if ! grep -qi "${gate}" "${CI_FILE}"; then
        fail "CI pipeline missing ${gate} stage"
        ALL_PASS=false
      fi
    done
  fi

  # Verify CD production has canary and rollback
  if [ -f ".github/workflows/cd-production.yml" ]; then
    CD_FILE=".github/workflows/cd-production.yml"
    for check in "canary" "rollback" "deploy-window" "approval"; do
      if ! grep -qi "${check}" "${CD_FILE}"; then
        fail "CD production pipeline missing ${check} stage"
        ALL_PASS=false
      fi
    done
  fi

  if [ "${ALL_PASS}" = true ]; then
    pass "All CI/CD pipeline files present and valid"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Main Execution
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║           GrainShield Go/No-Go Validation                  ║${NC}"
echo -e "${BOLD}║           Environment: ${ENVIRONMENT}                              ║${NC}"
echo -e "${BOLD}║           Date: $(date -u '+%Y-%m-%d %H:%M UTC')                       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"

check_1_compilation
check_2_formatting
check_3_tests
check_4_coverage
check_5_docker_build
check_6_no_secrets
check_7_k8s_manifests
check_8_frontend_build
check_9_deploy_window
check_10_pipeline_files

# ─── Final Verdict ───────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║                       RESULTS                              ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}║  ${GREEN}PASS: ${PASS_COUNT}${NC}${BOLD}    ${YELLOW}WARN: ${WARN_COUNT}${NC}${BOLD}    ${RED}FAIL: ${FAIL_COUNT}${NC}${BOLD}    Total: ${TOTAL_CHECKS}        ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════════╣${NC}"

if [ "${FAIL_COUNT}" -eq 0 ]; then
  echo -e "${BOLD}║  ${GREEN}██████╗  ██████╗                                         ║${NC}"
  echo -e "${BOLD}║  ${GREEN}██╔════╝ ██╔═══██╗                                        ║${NC}"
  echo -e "${BOLD}║  ${GREEN}██║  ███╗██║   ██║                                        ║${NC}"
  echo -e "${BOLD}║  ${GREEN}██║   ██║██║   ██║                                        ║${NC}"
  echo -e "${BOLD}║  ${GREEN}╚██████╔╝╚██████╔╝                                        ║${NC}"
  echo -e "${BOLD}║  ${GREEN} ╚═════╝  ╚═════╝   READY FOR DEPLOY                     ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
  exit 0
else
  echo -e "${BOLD}║  ${RED}███╗   ██╗ ██████╗        ██████╗  ██████╗               ║${NC}"
  echo -e "${BOLD}║  ${RED}████╗  ██║██╔═══██╗      ██╔════╝ ██╔═══██╗              ║${NC}"
  echo -e "${BOLD}║  ${RED}██╔██╗ ██║██║   ██║█████╗██║  ███╗██║   ██║              ║${NC}"
  echo -e "${BOLD}║  ${RED}██║╚██╗██║██║   ██║╚════╝██║   ██║██║   ██║              ║${NC}"
  echo -e "${BOLD}║  ${RED}██║ ╚████║╚██████╔╝      ╚██████╔╝╚██████╔╝              ║${NC}"
  echo -e "${BOLD}║  ${RED}╚═╝  ╚═══╝ ╚═════╝        ╚═════╝  ╚═════╝               ║${NC}"
  echo -e "${BOLD}║  ${RED}DEPLOY BLOCKED — fix ${FAIL_COUNT} failing check(s)              ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
  exit 1
fi
