import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    const { data: villas, error: villasError } = await supabase
      .from('villas')
      .select('*')
      .limit(10)

    const { data: expensesData, error: expensesError } = await supabase
      .from('expenses')
      .select('villa_id')

    const uniqueVillaIds = [
      ...new Set(
        (expensesData ?? [])
          .map((expense) => expense.villa_id)
          .filter((villaId): villaId is string => Boolean(villaId))
      ),
    ]

    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('*')
      .is('villa_id', null)
      .limit(10)

    return Response.json({
      villas: {
        data: villas,
        error: villasError,
      },
      expenses: {
        count: expensesData?.length ?? 0,
        error: expensesError,
      },
      uniqueVillaIdsInExpenses: uniqueVillaIds,
      bookingsWithoutVillaId: {
        count: bookings?.length,
        samples: bookings?.slice(0, 3),
        error: bookingsError,
      },
    })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
