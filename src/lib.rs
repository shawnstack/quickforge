pub mod modes;
pub mod policy;

pub fn app_name() -> &'static str {
    "fastcode"
}

#[cfg(test)]
mod tests {
    use super::app_name;

    #[test]
    fn app_name_is_stable() {
        assert_eq!(app_name(), "fastcode");
    }
}
