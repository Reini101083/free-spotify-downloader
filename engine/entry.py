"""Process entry point for the separately packaged, MIT-licensed spotDL dependency."""
import multiprocessing
import sys

if __name__ == '__main__':
    multiprocessing.freeze_support()
    if len(sys.argv) > 1 and sys.argv[1] == '--library':
        from library import main
        main(sys.argv[2])
    elif len(sys.argv) > 1 and sys.argv[1] in ('--diagnostics', '--download-diagnostics'):
        from provider import diagnostics
        diagnostics(sys.argv[2], sys.argv[3], download_check=sys.argv[1] == '--download-diagnostics')
    elif len(sys.argv) > 1 and sys.argv[1] in ('--session', '--resolve'):
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
        from provider import install_diagnostics, prepare_external_tools
        install_diagnostics()
        prepare_external_tools()
        console_entry_point()
