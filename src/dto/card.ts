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
    Skip = 'skip',
    Reverse = 'reverse',
    DrawTwo = 'drawTwo',
    Wild = 'wild',
    WildDrawFour = 'wildDrawFour',
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