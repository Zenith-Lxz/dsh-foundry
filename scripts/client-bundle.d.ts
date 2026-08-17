/**
 * The specifiers the shell seeds into its frozen module table.
 *
 * This mirrors the host's platform module list. A specifier absent here and
 * present at runtime is a build-time error rather than a blank screen.
 */
export declare const CLIENT_EXTERNALS: readonly string[];
export declare function buildClientBundle(options: {
    id: string;
    packageDir: string;
}): Promise<void>;
//# sourceMappingURL=client-bundle.d.ts.map