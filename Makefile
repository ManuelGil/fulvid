# Local Linux distribution interface. Not used by GitHub Actions.
# Windows and macOS are not Make targets.

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
LINUX := $(ROOT)/packaging/linux

.PHONY: package release verify-release clean help

.DEFAULT_GOAL := help

package:
	$(LINUX)/package.sh

release:
	$(LINUX)/release.sh

verify-release:
	$(LINUX)/verify.sh

clean:
	$(LINUX)/clean.sh

help:
	@printf '%s\n' \
		'make package        - Linux Electrobun artifacts and .deb into artifacts/' \
		'make release        - Signed Linux release (PGP + verify)' \
		'make verify-release - Verify an existing Linux artifacts/ set' \
		'make clean          - Remove build/, dist/, and artifacts/' \
		''
