"""Process entry point for the separately packaged, MIT-licensed spotDL dependency."""
import multiprocessing
import sys

if __name__ == '__main__':
    multiprocessing.freeze_support()
    if len(sys.argv) > 1 and sys.argv[1] in ('--session', '--resolve'):
        from session import main, report_error
        try:
            main(sys.argv[1:])
        except KeyboardInterrupt:
            sys.exit(130)
        except Exception as error:
            if sys.argv[1] == '--resolve':
                raise
            report_error(error)
            sys.exit(1)
    else:
        from spotdl import console_entry_point
        console_entry_point()
