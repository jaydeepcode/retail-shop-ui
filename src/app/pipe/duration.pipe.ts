import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'duration'
})
export class DurationPipe implements PipeTransform {
    transform(value: { start?: Date | string, end?: Date | string } | null): string {
        if (!value?.start && !value?.end) {
            return 'N/A';
        }
        if (!value?.start || !value?.end) {
            return 'In Progress';
        } 
        const start = new Date(value.start);
        const end = new Date(value.end);
        const diffMs = end.getTime() - start.getTime();
        const totalSeconds = Math.floor(diffMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        return `${minutes}m ${seconds}s`;
    }
}
