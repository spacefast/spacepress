/**
 * Hand-written components over the generated set: the blocks a page or a
 * template reaches for most, under the names authors know them by. Each is
 * the generated component re-exported, so the serializer checks it like any
 * other; nothing here adds behaviour, only a shorter name.
 */
import { Core } from "./blocks.generated.ts";

export const Paragraph = Core.Paragraph;
export const Heading = Core.Heading;
export const Image = Core.Image;
export const Group = Core.Group;
export const Columns = Core.Columns;
export const Column = Core.Column;
export const Cover = Core.Cover;
export const Spacer = Core.Spacer;
export const Separator = Core.Separator;
export const Buttons = Core.Buttons;
export const Button = Core.Button;
export const MediaText = Core.MediaText;
export const Gallery = Core.Gallery;
export const Embed = Core.Embed;
export const Html = Core.Html;
