.PHONY: install build typecheck lint test check depcruise clean

PNPM ?= pnpm

install:
	$(PNPM) install --frozen-lockfile

build:
	$(PNPM) build

typecheck:
	$(PNPM) typecheck

lint:
	$(PNPM) lint

test:
	$(PNPM) test

depcruise:
	$(PNPM) depcruise

check:
	$(PNPM) check

clean:
	rm -rf packages/*/dist dist-release coverage
