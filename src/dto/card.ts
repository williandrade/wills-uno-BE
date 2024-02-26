enum Color {
    Red = 'Red',
    Yellow = 'Yellow',
    Green = 'Green',
    Blue = 'Blue',
}

enum Value {
    Zero = '0',
    One = '1',
    Two = '2',
    Three = '3',
    Four = '4',
    Five = '5',
    Six = '6',
    Seven = '7',
    Eight = '8',
    Nine = '9',
    Skip = 'Skip',
    Reverse = 'Reverse',
    DrawTwo = 'Draw Two',
    Wild = 'Wild',
    WildDrawFour = 'Wild Draw Four',
}

enum Type {
    Number,
    Action,
    Wild,
    WildDrawFour,
}
interface UnoCard {
    color: Color | null; // 'null' for wild cards
    value: Value;
    type: Type;
}

export { UnoCard, Color, Value, Type };