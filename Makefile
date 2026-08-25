include server.conf

.PHONY: serve clean

serve:
	@echo "Starting server on http://localhost:$(PORT)"
	@python3 -m http.server $(PORT) &>/dev/null &
	@open http://localhost:$(PORT)

clean:
	@echo "Nothing to clean (static site)"
