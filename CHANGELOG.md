# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project scaffold.
- `GET /health`; worker-runtime tests; Biome, pre-commit, Dependabot.

### Changed

- Adopted `cloudflare-worker-template`: production is a named wrangler environment, CI and deploys use the shared reusable workflows, deploys moved from Cloudflare Workers Builds to GitHub Actions.
