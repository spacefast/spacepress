/**
 * `"php/wordpress"`: WordPress core from a Zero app. Map it next to `"zero"` in tsconfig.json:
 *
 * ```json
 * "paths": { "zero": [".../types/index.d.ts"], "php/wordpress": [".../types/wordpress.d.ts"] }
 * ```
 *
 * `zero build` augments `Abilities` in `zero.gen.ts` with the app's own abilities and those locked in
 * `zero/abilities.json` (`zero abilities pull --site <url>`).
 */

/** Ability name → `{ input; output }`, generated into `zero.gen.ts`. */
export interface Abilities {}

export type AbilityName = keyof Abilities & string;
export type AbilityInput<N extends AbilityName> = Abilities[N] extends { input: infer I } ? I : never;
export type AbilityOutput<N extends AbilityName> = Abilities[N] extends { output: infer O } ? O : never;

/**
 * Registered WordPress abilities (the Abilities API), run through core's `WP_Ability::execute()`:
 * core validates the input, checks the ability's permission for the current WordPress user and
 * validates the output. The name must be a string literal.
 *
 * Throws `HttpError(503, "ability_unavailable")` when the site does not have the ability, and maps a
 * `WP_Error` to an `HttpError`: its own `status` when it has one, otherwise 401/403 for a permission
 * failure, 422 for invalid input and 500 for anything else.
 */
export declare const abilities: {
  call<N extends AbilityName>(
    name: N,
    ...input: {} extends AbilityInput<N> ? [input?: AbilityInput<N>] : [input: AbilityInput<N>]
  ): Promise<AbilityOutput<N>>;
};
