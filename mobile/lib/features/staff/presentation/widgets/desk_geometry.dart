/// Card geometry for the clinic panel, in one place.
///
/// A section, the tiles inside it and the buttons on it are three different
/// sizes of the same idea, and they were previously three unrelated numbers
/// picked per widget. Naming them keeps the nesting readable: an inner tile is
/// always visibly rounder-cornered than the card it sits in, never the reverse.
///
/// Shared rather than private to one screen, because the request card is now
/// drawn on two — the desk's Today tab and the appointments diary — and a
/// constant that lives in one screen is a constant the other quietly redefines
/// a point or two off.
const double kSectionRadius = 20;
const double kInnerRadius = 14;
