#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrandId {
    AximSystems,
    Ellars,
    AmericanPirateFederation,
    Asguard,
}

impl BrandId {
    #[must_use]
    pub fn forbidden_terms(&self) -> &'static [&'static str] {
        match self {
            BrandId::AximSystems => &["Speculative", "Web3 tokens", "Hype-words"],
            BrandId::Ellars => &["Corporate buzzwords", "Committee phrasing"],
            BrandId::AmericanPirateFederation => {
                &["Compliance frameworks", "Institutional standards"]
            }
            BrandId::Asguard => &["Safe", "Assured", "Vulnerable"],
        }
    }
}
