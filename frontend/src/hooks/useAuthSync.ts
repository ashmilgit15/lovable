import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-react";
import { registerGetToken } from "@/lib/auth";

/**
 * Hook that syncs Clerk's getToken function to the global auth helper.
 * Mount this once in a component inside <ClerkProvider>.
 */
export function useAuthSync() {
    const queryClient = useQueryClient();
    const { getToken, userId, isLoaded } = useAuth();
    const previousUserIdRef = useRef<string | null | undefined>(undefined);

    // Ensure API helpers can attach auth headers during the first render cycle.
    registerGetToken(getToken);

    useEffect(() => {
        registerGetToken(getToken);
    }, [getToken]);

    useEffect(() => {
        if (!isLoaded) return;
        if (previousUserIdRef.current === userId) return;
        previousUserIdRef.current = userId;

        // Prevent stale per-user data from leaking across account switches.
        queryClient.removeQueries({ queryKey: ["projects"] });
        queryClient.removeQueries({ queryKey: ["templates"] });
        queryClient.removeQueries({ queryKey: ["providers"] });
        queryClient.removeQueries({ queryKey: ["routing-config"] });
    }, [isLoaded, queryClient, userId]);
}
