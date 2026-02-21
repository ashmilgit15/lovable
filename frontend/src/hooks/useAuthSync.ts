import { useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { registerGetToken } from "@/lib/auth";

/**
 * Hook that syncs Clerk's getToken function to the global auth helper.
 * Mount this once in a component inside <ClerkProvider>.
 */
export function useAuthSync() {
    const { getToken } = useAuth();

    useEffect(() => {
        registerGetToken(getToken);
    }, [getToken]);
}
