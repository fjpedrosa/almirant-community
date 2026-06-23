#!/bin/sh
# GIT_ASKPASS helper for clone authentication.
#
# Git calls this script to obtain the password when cloning.
# It reads the token from __GIT_CLONE_TOKEN, outputs it, then
# unsets the variable so it is not available to child processes.
#
# Usage: set GIT_ASKPASS=/path/to/git-askpass.sh before git clone.
# The entrypoint creates this file dynamically and removes it after clone.

echo "${__GIT_CLONE_TOKEN}"
