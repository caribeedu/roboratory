# Security policy

Promptory starts AI agents on your machine, with your files and your agent CLIs' credentials, so security reports are taken seriously.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability reporting: open the **Security** tab of the repository and choose **Report a vulnerability**.

Include what you found, how to reproduce it and the impact you expect. You will get an acknowledgement, and fixes are prioritized by severity.

## Design notes relevant to security

- Everything runs locally. There is no telemetry, and no network port is opened by the app.
- Promptory stores no credentials. Agents use the credentials of the agent CLIs you have signed in to.
- Machines are told which folders belong to their run, and which shell commands they may use. These are instructions and permission rules for the agent CLI, not a sandbox: a machine with an open shell can touch anything your user can. Give machines the narrowest `allow` list that works, and keep gates before every outward action (pushing, posting, deploying).
- Managers run read-only through the agent CLI and return changes as patches that are written only when you accept them. Releasing a gate and applying a change are never automatic, whatever the policy says.
- Every action is a verb through one API and is written to an audit log.
- A factory is code: its signals are scripts that run on your machine, and its roles are prompts. Review a factory you did not write, and the diff of every change to one, before running it.
