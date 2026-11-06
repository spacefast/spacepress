//! JavaScript number formatting, shared by the evaluator (template literals at
//! build time) and the PHP emitter (literals).

/// ECMAScript ToUint32: truncate, then reduce modulo 2^32.
pub fn to_uint32(x: f64) -> u32 {
    if !x.is_finite() || x == 0.0 {
        0
    } else {
        x.trunc().rem_euclid(4294967296.0) as u32
    }
}

pub fn to_int32(x: f64) -> i32 {
    to_uint32(x) as i32
}

pub fn round(x: f64) -> f64 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    if (-0.5..0.0).contains(&x) {
        return -0.0;
    }
    let floor = x.floor();
    if x - floor < 0.5 { floor } else { floor + 1.0 }
}

pub fn pow(a: f64, b: f64) -> f64 {
    if b == 0.0 {
        return 1.0;
    }
    if a.is_nan() || b.is_nan() || (a.abs() == 1.0 && b.is_infinite()) {
        return f64::NAN;
    }
    a.powf(b)
}

pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_negative() || b.is_sign_negative() {
            -0.0
        } else {
            0.0
        };
    }
    a.min(b)
}

pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_positive() || b.is_sign_positive() {
            0.0
        } else {
            -0.0
        };
    }
    a.max(b)
}

/// ECMAScript WhiteSpace and LineTerminator (not Unicode's White_Space).
pub fn is_js_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// Convert power-of-two radix digits with one ties-to-even binary64 rounding.
/// Rounding each multiply/add loses low bits before the last digit arrives.
pub fn radix_number(digits: &[u32], radix: u32) -> f64 {
    if !radix.is_power_of_two() {
        return digits.iter().fold(0.0, |n, d| n * radix as f64 + *d as f64);
    }
    let width = radix.trailing_zeros();
    let bits: Vec<_> = digits
        .iter()
        .flat_map(|digit| (0..width).rev().map(move |bit| (digit >> bit) & 1))
        .skip_while(|bit| *bit == 0)
        .collect();
    if bits.len() > 1024 {
        return f64::INFINITY;
    }
    let mut significand = bits.iter().take(53).fold(0u64, |n, bit| (n << 1) | *bit as u64);
    if bits.len() <= 53 {
        return significand as f64;
    }
    if bits[53] == 1 && (significand & 1 == 1 || bits[54..].contains(&1)) {
        significand += 1;
    }
    significand as f64 * 2f64.powi((bits.len() - 53) as i32)
}

/// `Number.prototype.toString()` for any f64.
pub fn js_number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if x == 0.0 {
        return "0".into();
    }
    // Shortest round-trip digits via Rust's `{:e}`: "d.ddde[-]x".
    let sci = format!("{:e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').expect("exponent form");
    let exp: i32 = exp.parse().expect("exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exp + 1; // position of the decimal point relative to the digits
    let sign = if x < 0.0 { "-" } else { "" };
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let e = if e >= 0 { format!("+{e}") } else { e.to_string() };
        if k == 1 {
            format!("{digits}e{e}")
        } else {
            format!("{}.{}e{e}", &digits[..1], &digits[1..])
        }
    };
    format!("{sign}{body}")
}

/// True when `x` is an integer PHP can hold exactly and JS prints without exponent.
pub fn is_safe_int(x: f64) -> bool {
    x.fract() == 0.0 && x.abs() <= 9_007_199_254_740_991.0 && !(x == 0.0 && x.is_sign_negative())
}

/// A PHP literal for a number.
pub fn php_number(x: f64) -> String {
    if x.is_nan() {
        "NAN".into()
    } else if x.is_infinite() {
        if x > 0.0 { "INF".into() } else { "-INF".into() }
    } else if is_safe_int(x) {
        format!("{}", x as i64)
    } else if x == 0.0 {
        "-0.0".into()
    } else {
        let s = format!("{x:?}");
        if s.contains('.') || s.contains('e') {
            s
        } else {
            format!("{s}.0")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_javascript() {
        let cases = [
            (0.1 + 0.2, "0.30000000000000004"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (1e-7, "1e-7"),
            (0.000001, "0.000001"),
            (-0.0, "0"),
            (123.456, "123.456"),
            (5e-324, "5e-324"),
            (1.5e300, "1.5e+300"),
            (-42.0, "-42"),
        ];
        for (x, want) in cases {
            assert_eq!(js_number_to_string(x), want, "{x:?}");
        }
    }
}
