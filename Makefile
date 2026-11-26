include server.conf

.PHONY: serve serve-eldorado clean

serve:
	@echo "Starting server on http://localhost:$(PORT)"
	@python3 -m http.server $(PORT) &>/dev/null &
	@open http://localhost:$(PORT)

serve-eldorado:
	@echo "Starting El Dorado server on http://localhost:$(PORT)"
	@cd eldorado && PORT=$(PORT) node server.js &>/dev/null &
	@open http://localhost:$(PORT)/eldorado/

clean:
	@echo "Nothing to clean (static site)"
