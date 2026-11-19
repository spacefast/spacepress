import { is_user_logged_in } from "php/wordpress";
import { Comments, Content, Live, notFound, useFormState, type PageProps } from "typedpress/app";
import { bookSeats } from "../../../server";

export const metadata = ({ item }: PageProps<"events/[slug]">) => ({ title: item?.title ?? "Workshop" });

export default function Workshop({ item }: PageProps<"events/[slug]">) {
  if (!item) notFound();
  const booking = useFormState(bookSeats);
  return (
    <article>
      <h1>{item.title}</h1>
      <p>{item.startsOn} · {item.venue}</p>
      <Content value={item.description} />
      <Live id="registration">
        <p>{item.registrationOpen ? "Registration is open." : "Registration is closed."}</p>
      </Live>
      {is_user_logged_in() && item.registrationOpen && (
        <form action={bookSeats}>
          <input type="hidden" name="eventId" value={item.id} />
          <label>Seats <input name="seats" type="number" min={1} max={4} defaultValue={booking.values.seats ?? 1} /></label>
          <label>Email <input name="email" type="email" required defaultValue={booking.values.email ?? ""} /></label>
          <button>Reserve seats</button>
        </form>
      )}
      {booking.error && <p role="alert">{booking.error.message}</p>}
      {booking.result && <p>Reservation code: {booking.result.code}</p>}
      <Comments for={item} />
    </article>
  );
}
