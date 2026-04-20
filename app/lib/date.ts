export function getNearestWeekday(date = new Date()): Date {
    const d = new Date(date);
    while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() - 1);
    }
    return d;
}

export function toDateInputValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function toApiDate(value: string): string {
    return value.replace(/-/g, "");
}

export function toDateInputFromApi(value: string): string {
    if (!/^\d{8}$/.test(value)) {
        return value;
    }

    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    return `${year}-${month}-${day}`;
}
