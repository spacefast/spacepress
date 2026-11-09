// Zero host shape for the official PortableTextBlock import; algorithm source is unchanged.
export type PortableTextBlock = {
  _type: string;
  children?: { _type: string; text?: string }[];
};
