//! Whitespace layout for compiler-owned PHP. The emitter produces pure PHP with quoted
//! strings (never heredocs or inline HTML). Keep literals and comments byte-for-byte;
//! this pass changes only the gaps around parentheses, not PHP expressions or names.

pub(crate) fn parentheses(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let start = i;
        match bytes[i] {
            b'\'' | b'"' | b'`' => {
                let quote = bytes[i];
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\\' {
                        i = (i + 2).min(bytes.len());
                    } else if bytes[i] == quote {
                        i += 1;
                        break;
                    } else {
                        i += 1;
                    }
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i += 2;
                while i < bytes.len() && !bytes[i..].starts_with(b"*/") {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
            }
            b'/' if bytes.get(i + 1) == Some(&b'/') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'#' if bytes.get(i + 1) != Some(&b'[') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            c if c.is_ascii_whitespace() => {
                i += 1;
                continue;
            }
            c if c.is_ascii_alphanumeric() || c == b'_' => {
                i += 1;
                while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                    i += 1;
                }
            }
            _ => i += source[i..].chars().next().expect("character").len_utf8(),
        }
        tokens.push(start..i);
    }
    let value = |n: usize| &source[tokens[n].clone()];
    let mut cast = vec![false; tokens.len()];
    for n in 0..tokens.len().saturating_sub(2) {
        if value(n) == "("
            && value(n + 2) == ")"
            && matches!(
                value(n + 1),
                "int" | "float" | "bool" | "string" | "array" | "object" | "unset"
            )
        {
            cast[n] = true;
            cast[n + 2] = true;
        }
    }
    let mut out = String::with_capacity(source.len());
    let mut end = 0;
    for (n, token) in tokens.iter().enumerate() {
        let gap = &source[end..token.start];
        if n > 0 && !gap.contains(['\n', '\r']) {
            let left = value(n - 1);
            let right = value(n);
            if left == "(" && right == ")" {
                // Empty argument/parameter lists stay empty.
            } else if (left == "(" && !cast[n - 1]) || (right == ")" && !cast[n]) {
                out.push(' ');
            } else {
                out.push_str(gap);
            }
        } else {
            out.push_str(gap);
        }
        out.push_str(&source[token.clone()]);
        end = token.end;
    }
    out.push_str(&source[end..]);
    out
}

#[cfg(test)]
mod tests {
    use super::parentheses;

    #[test]
    fn formats_nested_calls_declarations_and_conditions_but_keeps_casts_and_empty_lists() {
        let source = "function f($x) { if (($x > 0)) { return foo((int)$x, bar(), []); } }";
        let expected = "function f( $x ) { if ( ( $x > 0 ) ) { return foo( (int)$x, bar(), [] ); } }";
        assert_eq!(parentheses(source), expected);
        assert_eq!(parentheses(expected), expected);
        assert_eq!(parentheses("$żółć = f($x);"), "$żółć = f( $x );");
    }

    #[test]
    fn keeps_literals_comments_unicode_and_multiline_indentation() {
        let source = "foo('a\\\' (x)', \"żółć ($x) \\\"\", `echo (x)`); // (comment)\n/* (x) */\n# (x)\nfoo(\n\t$x\n);";
        let expected =
            "foo( 'a\\\' (x)', \"żółć ($x) \\\"\", `echo (x)` ); // (comment)\n/* (x) */\n# (x)\nfoo(\n\t$x\n);";
        assert_eq!(parentheses(source), expected);
    }
}
