const name = "greet";
class Greeter {
  [name]() { return "hi"; }
}
export const make = () => new Greeter().greet();
