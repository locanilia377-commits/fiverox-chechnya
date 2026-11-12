-- Run by migration owner AFTER creating a restricted LOGIN role named fiverox_runtime.
-- Do not grant ownership, superuser, CREATEROLE, CREATEDB or BYPASSRLS to runtime.
GRANT USAGE ON SCHEMA fiverox TO fiverox_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA fiverox TO fiverox_runtime;
GRANT INSERT,UPDATE ON fiverox.clients,fiverox.transfers,fiverox.items,fiverox.users,fiverox.dealers,fiverox.invitations,fiverox.rate_limits TO fiverox_runtime;
GRANT INSERT ON fiverox.audit,fiverox.operations TO fiverox_runtime;
GRANT INSERT,UPDATE,DELETE ON fiverox.sessions,fiverox.challenges TO fiverox_runtime;
GRANT EXECUTE ON FUNCTION fiverox.actor_id(),fiverox.is_staff() TO fiverox_runtime;
