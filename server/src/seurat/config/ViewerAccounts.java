package seurat.config;

import java.util.HashMap;
import java.util.Map;

/**
 * Viewer accounts for POST /seurat/v1/sesion (spec 3.1: "Autentica (cookie o Bearer)"):
 * `auth.accounts = name:key:role, ...` in seurat.conf. A request whose Bearer is a known key
 * gets that account's name as principal and its role; any other Bearer is refused.
 */
public final class ViewerAccounts {
    /** One account: `name` names the principal (and its coverage directory). */
    public record Account(String name, String role) {}

    private final Map<String, Account> byKey = new HashMap<>();

    /** Malformed entries (wrong arity, empty or unsafe fields) are skipped. */
    public ViewerAccounts(String spec) {
        for (String entry : spec.split(",")) {
            String[] f = entry.trim().split(":");
            if (f.length == 3 && f[0].matches("[A-Za-z0-9_-]+") && !f[1].isBlank() && !f[2].isBlank()) {
                byKey.put(f[1].trim(), new Account(f[0], f[2].trim()));
            }
        }
    }

    /** The account a Bearer key names, or null. */
    public Account find(String key) {
        return byKey.get(key);
    }

    public int size() {
        return byKey.size();
    }
}
