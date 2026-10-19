# Security policy

## Supported versions

Only the latest commit on the `main` branch is supported. Self-hosted deploys should track `main` or a recent release tag cut from it.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Report privately through the repository [Security tab](https://github.com/MrF1ow/foodable/security/advisories/new) (GitHub private vulnerability reporting). Describe what you found and how it affects a typical self-hosted Foodable instance. We will acknowledge receipt and work on a fix; coordinated disclosure details can be agreed in the advisory thread.

There is **no bug bounty** and no paid reward program.

## Scope

In scope for this policy:

- The Foodable server (HTTP routes, MCP endpoint, session handling)
- OAuth and login flows for the household app and MCP clients
- Supabase row-level security and policies as shipped in this repository

Out of scope: third-party hosts (Railway, Supabase cloud console), MCP client bugs, and issues that require physical access to your machine or stolen long-lived credentials you pasted into a public channel.

We are not asking for step-by-step exploit instructions in the initial report; enough detail to reproduce in a private advisory is sufficient.
