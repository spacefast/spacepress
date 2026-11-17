//! Whitespace layout for compiler-owned PHP. The emitter produces pure PHP with quoted
//! strings (never heredocs or inline HTML). Keep literals and comments byte-for-byte;
//! this pass lays out parentheses and spells array literals as `array(...)`. Indexing
//! retains square brackets. The compiler lowers destructuring to explicit assignments.

pub(crate) fn format(source: &str) -> String {
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
            b'!' if bytes.get(i + 1) == Some(&b'=') => {
                i += if bytes.get(i + 2) == Some(&b'=') { 3 } else { 2 };
            }
            b'$' => {
                i += 1;
                while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_' || bytes[i] >= 128) {
                    i += 1;
                }
            }
            b'.' if bytes[i..].starts_with(b"...") => i += 3,
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
    // A literal starts where an expression may begin. A bracket following a value,
    // variable, property, call, or another closing bracket is an index instead.
    let mut arrays = vec![false; tokens.len()];
    let mut brackets = Vec::new();
    for (n, is_array) in arrays.iter_mut().enumerate() {
        match value(n) {
            "[" => {
                let literal = n == 0
                    || (n < 2 || !matches!(value(n - 2), ">" | ":"))
                        && matches!(
                            value(n - 1),
                            "(" | "["
                                | "..."
                                | ","
                                | "="
                                | ":"
                                | "?"
                                | ">"
                                | "<"
                                | "+"
                                | "-"
                                | "*"
                                | "/"
                                | "%"
                                | "!"
                                | "&"
                                | "|"
                                | "^"
                                | "~"
                                | "return"
                                | "yield"
                                | "case"
                                | "echo"
                                | "throw"
                                | "!="
                                | "!=="
                        );
                *is_array = literal;
                brackets.push(literal);
            }
            "]" => *is_array = brackets.pop().unwrap_or(false),
            _ => {}
        }
    }
    let mut indexes = vec![false; tokens.len()];
    let mut openings = Vec::new();
    for n in 0..tokens.len() {
        match value(n) {
            "[" => openings.push(n),
            "]" => {
                let open = openings.pop().expect("emitted brackets match");
                let first = if matches!(value(open + 1), "+" | "-") {
                    open + 2
                } else {
                    open + 1
                };
                let simple = n == open + 1
                    || (n == first + 1
                        && (constant_string(value(first)) || value(first).bytes().all(|b| b.is_ascii_digit())));
                if !arrays[open] && !simple && (open == 0 || value(open - 1) != "#") {
                    indexes[open] = true;
                    indexes[n] = true;
                }
            }
            _ => {}
        }
    }
    let assignment_gaps = assignment_gaps(source, &tokens);
    let layout_token = |n: usize| match (value(n), arrays[n]) {
        ("[", true) => "(",
        ("]", true) => ")",
        _ => value(n),
    };
    let mut out = String::with_capacity(source.len());
    let mut end = 0;
    for (n, token) in tokens.iter().enumerate() {
        let gap = &source[end..token.start];
        if n > 0 && !gap.contains(['\n', '\r']) {
            let left = layout_token(n - 1);
            let right = layout_token(n);
            if left == "(" && right == ")" {
                // Empty argument/parameter lists stay empty.
            } else if (left == "(" && !cast[n - 1])
                || (right == ")" && !cast[n])
                || (left == "[" && indexes[n - 1])
                || (right == "]" && indexes[n])
                || left == "!"
                || right == "!"
            {
                out.push(' ');
            } else if assignment_gaps[n] > 0 {
                out.extend(std::iter::repeat_n(' ', assignment_gaps[n]));
            } else {
                out.push_str(gap);
            }
        } else {
            out.push_str(gap);
        }
        match (value(n), arrays[n]) {
            ("[", true) => out.push_str("array("),
            ("]", true) => out.push(')'),
            _ => out.push_str(&source[token.clone()]),
        }
        end = token.end;
    }
    out.push_str(&source[end..]);
    while out.ends_with("\n\n") {
        out.pop();
    }
    out
}

fn constant_string(value: &str) -> bool {
    if value.starts_with('\'') {
        return true;
    }
    if !value.starts_with('"') {
        return false;
    }
    let mut bytes = value.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'\\' {
            bytes.next();
        } else if byte == b'$' {
            return false;
        }
    }
    true
}

// Align only bare-variable assignments at the start of consecutive, equally
// indented lines. Token boundaries keep literal/comment contents opaque.
fn assignment_gaps(source: &str, tokens: &[std::ops::Range<usize>]) -> Vec<usize> {
    let mut candidates = Vec::new();
    let mut line = 0;
    let mut line_start = 0;
    let mut cursor = 0;
    for (n, token) in tokens.iter().enumerate() {
        for (offset, byte) in source.as_bytes()[cursor..token.start].iter().enumerate() {
            if *byte == b'\n' {
                line += 1;
                line_start = cursor + offset + 1;
            }
        }
        cursor = token.start;
        let indent = &source[line_start..token.start];
        if source[token.clone()].starts_with('$')
            && indent.bytes().all(|b| b == b'\t' || b == b' ')
            && tokens.get(n + 1).is_some_and(|t| &source[t.clone()] == "=")
            && tokens
                .get(n + 2)
                .is_some_and(|t| !matches!(&source[t.clone()], "=" | ">"))
            && !source[token.end..tokens[n + 1].start].contains('\n')
        {
            candidates.push((line, indent, n + 1, source[token.clone()].chars().count()));
        }
    }
    let mut gaps = vec![0; tokens.len()];
    let mut start = 0;
    while start < candidates.len() {
        let mut end = start + 1;
        while end < candidates.len()
            && candidates[end].0 == candidates[end - 1].0 + 1
            && candidates[end].1 == candidates[start].1
        {
            end += 1;
        }
        let width = candidates[start..end].iter().map(|c| c.3).max().unwrap();
        for (_, _, token, len) in &candidates[start..end] {
            gaps[*token] = width - len + 1;
        }
        start = end;
    }
    gaps
}

#[cfg(test)]
mod tests {
    use super::format;

    #[test]
    fn formats_nested_calls_declarations_and_conditions_but_keeps_casts_and_empty_lists() {
        let source = "function f($x) { if (($x > 0)) { return foo((int)$x, bar(), []); } }";
        let expected = "function f( $x ) { if ( ( $x > 0 ) ) { return foo( (int)$x, bar(), array() ); } }";
        assert_eq!(format(source), expected);
        assert_eq!(format(expected), expected);
        assert_eq!(format("$żółć = f($x);"), "$żółć = f( $x );");
    }

    #[test]
    fn keeps_literals_comments_unicode_and_multiline_indentation() {
        let source = "foo('a\\\' (x)', \"żółć ($x) \\\"\", `echo (x)`); // (comment)\n/* (x) */\n# (x)\nfoo(\n\t$x\n);";
        let expected =
            "foo( 'a\\\' (x)', \"żółć ($x) \\\"\", `echo (x)` ); // (comment)\n/* (x) */\n# (x)\nfoo(\n\t$x\n);";
        assert_eq!(format(source), expected);
    }
}

#[cfg(test)]
mod array_tests {
    #[test]
    fn literals_become_long_arrays_but_indexes_and_strings_stay_intact() {
        let source = "return [[], ['k' => $a[0]], foo()[1], ['x'][0], $a[$i + 1], '[x]'];";
        let expected =
            "return array( array(), array( 'k' => $a[0] ), foo()[1], array( 'x' )[0], $a[ $i + 1 ], '[x]' );";
        assert_eq!(super::format(source), expected);
        assert_eq!(super::format(expected), expected);
        assert_eq!(super::format("foo(...[1]);"), "foo( ...array( 1 ) );");
        assert_eq!(
            super::format("return [$echo[0], $żółć[1], $x->echo[0], C::echo[0]];"),
            "return array( $echo[0], $żółć[1], $x->echo[0], C::echo[0] );"
        );
    }
}

#[cfg(test)]
mod mechanical_tests {
    #[test]
    fn aligns_assignment_groups_and_spaces_negation_and_computed_keys() {
        let source = "$x = 1;\n$long_name = '!';\n\n$x = !$long_name;\n$z = $items[$i + 1];\n\n";
        let expected = "$x         = 1;\n$long_name = '!';\n\n$x = ! $long_name;\n$z = $items[ $i + 1 ];\n";
        assert_eq!(super::format(source), expected);
        assert_eq!(super::format(expected), expected);
        assert_eq!(
            super::format("return $x != 1 && $y !== 2;"),
            "return $x != 1 && $y !== 2;"
        );
    }

    #[test]
    fn never_aligns_or_rewrites_statements_inside_literals_or_comments() {
        let source = "/*\n$a = !$x;\n$long = $items[$i];\n*/\nreturn '$a = !$x;\n$long = $items[$i];';";
        assert_eq!(super::format(source), source);
        assert_eq!(
            super::format("$a[0] = $a['k']; $a[] = $a[\"k\"];"),
            "$a[0] = $a['k']; $a[] = $a[\"k\"];"
        );
    }
}
