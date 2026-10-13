-- Separate database for the integration test suite so tests never touch dev data.
CREATE DATABASE aegis_test OWNER aegis;
CREATE DATABASE aegis_e2e OWNER aegis;
